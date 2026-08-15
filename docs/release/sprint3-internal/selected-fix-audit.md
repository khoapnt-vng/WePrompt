# Sprint 3 Selected-Fix Audit

The RC remains rooted at WePrompt `634f49c21567d9bd987b04887eaa0c6126b86353`. This audit reviews named later commits as objects; it does not authorize merging or rebasing onto `main`.

Each candidate must record its exact source commit, changed paths, dependency assumptions, baseline reproduction or contract need, smallest complete patch, focused tests before and after, and one disposition: `ported`, `already present`, `replaced`, or `excluded`.

| Candidate   | Area                                 | Changed paths and assumptions                                                     | Baseline evidence / contract need | Smallest complete patch | Focused evidence                            | Disposition |
| ----------- | ------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------- | ----------------------- | ------------------------------------------- | ----------- |
| `8c66c75ac` | Live WebSocket authentication        | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `95d8dd4ed` | Headerless/session-cookie requests   | Pending exact-diff review; unrelated form formatting is out of scope              | Pending                           | Pending                 | Pending                                     | Pending     |
| `1a310731b` | OfficeCLI packaged resolution        | Pending exact-diff review; release-carried managed resources are preferred        | Pending                           | Pending                 | Pending                                     | Pending     |
| `642665720` | OfficeCLI asset generation           | Pending exact-diff review; local generation must not duplicate the backend bundle | Pending                           | Pending                 | Pending                                     | Pending     |
| `c2c7de286` | Presentation template packaging path | Pending exact-diff review against builder and runtime inventory                   | Pending                           | Pending                 | Pending                                     | Pending     |
| `7820b7f93` | Windows release behavior             | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `4865c1ef0` | Windows release behavior             | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `8cafd02c4` | Windows release behavior             | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `6e6b0834c` | Windows release behavior             | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `371f0875b` | Windows release behavior             | Pending exact-diff review                                                         | Pending                           | Pending                 | Pending                                     | Pending     |
| `7a4c3cc79` | macOS signing and notarization       | Signing/notarization is outside the approved unsigned release                     | Not applicable                    | None                    | Scope decision in the accepted release plan | `excluded`  |

No row marked `Pending` may be ported. Every later source port must update its row with the resulting RC commit and red/green focused evidence.
