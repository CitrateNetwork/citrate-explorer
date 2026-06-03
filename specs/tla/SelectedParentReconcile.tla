------------------------- MODULE SelectedParentReconcile -------------------------
EXTENDS Naturals, FiniteSets, TLC

\* ============================================================================
\* CitrateScan indexer: selected-parent-chain reconciliation
\* Sprint S-1, WP-1.3
\*
\* Models how the CitrateScan indexer ingests a GHOSTDAG BlockDAG into its
\* database and reconciles consensus ordering + finality as `newHeads` arrive,
\* WITHOUT deleting finalized history.
\*
\* Domain facts:
\*   - Each block has a blueScore (consensus order, NOT DAG height) and one
\*     selectedParent (plus 0+ merge parents, abstracted away here since only
\*     the selected-parent chain drives ordering/finality reconciliation).
\*   - There may be MULTIPLE tips (blocks with no children) at once.
\*   - maxBlueScore = max blueScore over all known blocks.
\*   - A block is FINAL iff  maxBlueScore - block.blueScore >= FinalityDepth
\*     (FinalityDepth modeled small for tractability; real value is 100).
\*   - The DB marks blocks "live" or "superseded"; a sub-finality reorg
\*     re-points the selected-parent chain and marks displaced blocks
\*     "superseded" -- it NEVER deletes rows.
\*
\* Invariants -> WP-1.3 acceptance criteria:
\*   FinalityImmutable  -> "blocks at depth >= 100 are never rewritten":
\*                         once final, a block is never superseded and its
\*                         blueScore / selectedParent never change. (SAFETY)
\*   NoDeletion         -> "rows marked superseded, not removed": the set of
\*                         known block hashes is monotonically non-decreasing.
\*   SingleLiveChain    -> the live selected-parent chain from the highest
\*                         blueScore live tip back to Genesis is well-formed
\*                         (every selectedParent is known; no cycles).
\*   TypeOK             -> type-correctness of the state.
\* ============================================================================

CONSTANTS
    Hashes,         \* Finite set of possible block hashes (excluding Genesis)
    Genesis,        \* Distinguished genesis hash (blueScore 0, always live/final)
    FinalityDepth   \* Finality depth in blueScore units (model: 2 or 3; real: 100)

ASSUME GenesisNotInHashes == Genesis \notin Hashes
ASSUME FinalityDepthPos   == FinalityDepth \in Nat /\ FinalityDepth >= 1

\* All hashes the indexer could ever know about.
AllHashes == Hashes \cup {Genesis}

\* Status values a DB row can hold.
Status == {"live", "superseded"}

VARIABLES
    known,          \* SUBSET AllHashes : block hashes present as DB rows
    blueScore,      \* [known -> Nat]   : consensus order per block
    selParent,      \* [known -> AllHashes] : selected parent per block
    status,         \* [known -> Status]: DB liveness status per row
    maxBlue         \* Nat : cached max blueScore over all known blocks

vars == <<known, blueScore, selParent, status, maxBlue>>

\* ---------------------------------------------------------------------------
\* Helpers
\* ---------------------------------------------------------------------------

\* Highest blueScore actually present among known blocks (Genesis = 0 ensures
\* this is well-defined: known always contains Genesis).
MaxBlueScoreOf(K) == CHOOSE m \in {blueScore[b] : b \in K} :
                        \A b \in K : blueScore[b] <= m

\* A block is final iff it is at least FinalityDepth below the tip in blueScore.
IsFinal(b) == b \in known /\ (maxBlue - blueScore[b]) >= FinalityDepth

\* Live blocks (rows not superseded).
LiveBlocks == { b \in known : status[b] = "live" }

\* The highest-blueScore live tip: a live block with maximal blueScore.
\* (Genesis is always live, so this is well-defined.)
HighestLiveTip ==
    CHOOSE b \in LiveBlocks :
        \A c \in LiveBlocks : blueScore[c] <= blueScore[b]

\* Walk the selected-parent chain from b back toward Genesis, bounded by the
\* number of known blocks so the recursion always terminates.
RECURSIVE ChainFromBounded(_, _)
ChainFromBounded(b, fuel) ==
    IF fuel = 0 \/ b = Genesis \/ b \notin known
    THEN {b}
    ELSE {b} \cup ChainFromBounded(selParent[b], fuel - 1)

ChainFrom(b) == ChainFromBounded(b, Cardinality(AllHashes))

\* ---------------------------------------------------------------------------
\* Init
\* ---------------------------------------------------------------------------

Init ==
    /\ known     = {Genesis}
    /\ blueScore = [b \in {Genesis} |-> 0]
    /\ selParent = [b \in {Genesis} |-> Genesis]   \* Genesis is its own parent
    /\ status    = [b \in {Genesis} |-> "live"]
    /\ maxBlue   = 0

\* ---------------------------------------------------------------------------
\* Action: IngestBlock
\*   A new block (newHead) extends some known LIVE parent. Its blueScore is the
\*   parent's blueScore + 1 (selected-parent chain advances consensus order by
\*   one), which may raise maxBlue. The row is inserted "live".
\* ---------------------------------------------------------------------------

IngestBlock ==
    \E h \in (Hashes \ known) :          \* a brand-new, not-yet-known hash
      \E p \in LiveBlocks :              \* extending some currently-live block
        LET bs == blueScore[p] + 1 IN
        /\ known'     = known \cup {h}
        /\ blueScore' = (h :> bs)     @@ blueScore   \* extend domain with h
        /\ selParent' = (h :> p)      @@ selParent
        /\ status'    = (h :> "live") @@ status
        /\ maxBlue'   = IF bs > maxBlue THEN bs ELSE maxBlue

\* ---------------------------------------------------------------------------
\* Action: Reconcile
\*   A competing live chain has reached a strictly higher blueScore tip than
\*   some other live block b that is (a) NOT final and (b) not on the winning
\*   tip's selected-parent chain. The indexer marks b superseded. The row is
\*   NOT deleted; final blocks are never touched.
\* ---------------------------------------------------------------------------

Reconcile ==
    LET tip      == HighestLiveTip
        winChain == ChainFrom(tip)
    IN \E b \in LiveBlocks :
         /\ b # Genesis
         /\ ~IsFinal(b)                       \* never rewrite final history
         /\ b \notin winChain                 \* displaced by the winning chain
         /\ blueScore[b] < blueScore[tip]     \* a strictly-higher chain exists
         /\ status'    = [status EXCEPT ![b] = "superseded"]
         /\ UNCHANGED <<known, blueScore, selParent, maxBlue>>

\* Terminating: when no new hash can be ingested and no block can be
\* reconciled, the indexer has caught up to the DAG. We allow an explicit
\* stuttering step so a bounded model does not register as a TLC "deadlock";
\* this is a real terminal state of a finite DAG ingestion, not a bug.
Terminating ==
    /\ ~ENABLED IngestBlock
    /\ ~ENABLED Reconcile
    /\ UNCHANGED vars

Next == IngestBlock \/ Reconcile \/ Terminating

Spec == Init /\ [][Next]_vars /\ WF_vars(Reconcile)

\* ---------------------------------------------------------------------------
\* Invariants
\* ---------------------------------------------------------------------------

\* TypeOK -- type-correctness of the state.
TypeOK ==
    /\ known \subseteq AllHashes
    /\ Genesis \in known
    /\ blueScore \in [known -> Nat]
    /\ selParent \in [known -> AllHashes]
    /\ status \in [known -> Status]
    /\ maxBlue \in Nat
    /\ maxBlue = MaxBlueScoreOf(known)
    /\ blueScore[Genesis] = 0

\* NoDeletion (WP-1.3: "rows marked superseded, not removed").
\* Checked as an action property: known never shrinks across a step.
NoDeletion == [][known \subseteq known']_vars

\* FinalityImmutable (WP-1.3: "blocks at depth >= 100 are never rewritten").
\* Once a block is final it must be live (never superseded). Combined with the
\* action property below, this captures: final blocks are never rewritten.
FinalityImmutable == \A b \in known : IsFinal(b) => status[b] = "live"

\* FinalNeverRewritten -- action property: any block that is final in the
\* current state keeps the same blueScore, selectedParent, and live status in
\* the next state (its row is never rewritten or superseded by reconciliation).
FinalNeverRewritten ==
    [][ \A b \in known :
          IsFinal(b) =>
            /\ b \in known'
            /\ blueScore'[b] = blueScore[b]
            /\ selParent'[b] = selParent[b]
            /\ status'[b] = status[b] ]_vars

\* SingleLiveChain -- the live selected-parent chain from the highest-blueScore
\* live tip back to Genesis is well-formed: every selectedParent on the chain
\* is itself a known block, the chain reaches Genesis, and contains no cycle
\* (Genesis is the unique self-parent fixpoint).
SingleLiveChain ==
    LET chain == ChainFrom(HighestLiveTip) IN
    /\ Genesis \in chain
    /\ \A b \in chain : b \in known
    /\ \A b \in (chain \ {Genesis}) : selParent[b] \in known
    \* No non-Genesis block is its own selected parent (no length-1 cycle):
    /\ \A b \in (known \ {Genesis}) : selParent[b] # b

=============================================================================
