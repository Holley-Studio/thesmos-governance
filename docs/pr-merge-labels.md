# The two labels the merge engine runs on

`thesmos pr:merge` merges pull requests for you. `thesmos pr:watch` — a GitHub
Action — undoes one of those merges if the default branch goes red straight
afterwards. That undo is the reason merging unattended is defensible at all.

The two halves run in different places and share no files. They find each other
through **two labels on GitHub**:

| Label | Meaning | Applied by |
|---|---|---|
| `thesmos-merged` | Thesmos merged this pull request, and may automatically revert it if the branch goes red | `thesmos pr:merge`, right after the merge |
| `thesmos-reverted` | Thesmos has already reverted this one; never touch it again | `thesmos pr:watch`, right after the revert |

Both are created automatically the first time they are needed. You never have
to make them yourself.

## Read this before you edit either label by hand

**Labels are ordinary GitHub labels.** Anyone with write access can add or
remove them from any pull request, and the merge engine believes what it finds.
Two consequences, both worth knowing before you touch one:

- **Removing `thesmos-merged` from a merge makes that merge unrevertable.**
  `pr:watch` looks for merged pull requests carrying the label. Take it off and
  that merge becomes invisible to the watcher: if it turns out to be the one
  that broke the branch, nothing will undo it automatically and you will be
  reverting by hand.

- **Adding `thesmos-merged` to a pull request Thesmos did not merge puts
  someone else's work in scope.** If the branch goes red and that merge is in
  the recent range, `pr:watch` may open and merge a revert of it. Nothing about
  the label says who applied it, so there is no check that can catch this.

- **Removing `thesmos-reverted` from an already-reverted pull request can
  re-land the regression.** That label is the only record, on a fresh Actions
  runner, that this merge has been dealt with. Without it a later red build can
  select the same pull request again — and reverting a revert puts the original
  change back on the branch.

If you do want to take a merge permanently out of scope, removing
`thesmos-merged` is the right way to do it. Just do it knowing the trade: it
opts that merge out of automatic recovery, not just out of the bookkeeping.

## When Thesmos asks you to add one by hand

Two messages ask for this, and both mean the automatic path could not do it —
usually a permissions problem on the token:

```
Note: #12 really did merge, but I could not label it "thesmos-merged" (…).
Until that label is there, the automatic revert cannot undo this one.
Add it by hand with: gh pr edit 12 --add-label thesmos-merged
```

That merge is real and it is on the branch. It just is not recoverable
automatically until the label is there.

```
I could not label #12 "thesmos-reverted" (…), so I cannot promise not to
revert it again. Autonomy is now OFF. Add the label by hand, then:
thesmos autonomy on
```

This one is more urgent. The revert landed, but without the label a later red
build can pick #12 again and revert the revert. Thesmos switches itself off
rather than risk it. Add the label, then turn autonomy back on.

## Why labels, and not a file

The engine used to record its merges in `.thesmos/pr-ledger.jsonl` and push
that file to the default branch so the Action could read it. On any repository
whose default branch is protected — including this one — that push is rejected,
so the file never arrived and auto-revert could not fire on a single run.

Both halves already authenticate to GitHub. That is the transport they actually
share, and unlike a pushed file it needs no write access to the default branch.
The ledger still exists; it is the local audit trail, not the watcher's input.

## Related

- `thesmos pr:queue` — what is ready to merge and what is stuck
- `thesmos autonomy off` — stop Thesmos merging or changing anything
- `.github/workflows/thesmos-watch.yml` — the watcher, and why it triggers the
  way it does
