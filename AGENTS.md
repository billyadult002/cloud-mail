# Repository Boundary Policy & Agent Rules

## SOURCE OF TRUTH
`/Users/billtin/Documents/CloudMail`

## FORBIDDEN WRITE LOCATIONS
- `~/.hermes`
- `~/.gemini`
- `~/Desktop` or `Desktop`
- `~/Downloads` or `Downloads`
- Any location outside `/Users/billtin/Documents/cloudmail` unless explicitly authorized.

---

## PRETASK CHECK (MANDATORY BEFORE ANY TASK)
Before running any commands, performing research, or writing any files, the Agent MUST execute the automated repository check script:
```bash
python3 scripts/repository_check.py cloudmail --task "<task_name>"
```

### Expected Output Format
```
REPOSITORY_CHECK
repository=cloudmail
cwd=<current_working_directory>
git_root=N/A
branch=N/A
source_of_truth=true
SUCCESS: Repository check passed.
```

> [!CAUTION]
> **FAIL HARD ON MISMATCH (Exit Code 99):** If any of the above parameters do not match the expected values, or if the script outputs `MIRROR_OR_SNAPSHOT_DETECTED` or `WRITE_PROTECTION_VIOLATION`, the Agent MUST immediately halt execution and fail the task. No auto-recovery or fallback is allowed.

---

# Agent Loop Engineering Playbook

For all future coding, debugging, and implementation tasks, you MUST follow the **Loop Engineering** methodology (Maker-Checker pattern) to design and execute your workflow. This ensures correctness, prevents self-bias, and maintains codebase integrity.

## The 5 Moves of the Coding Loop

Every coding task must be executed through the following five moves:
1. **Discovery (Self-directed Triage)**: Research the codebase and run diagnostics (e.g., compile, run existing tests, lint) to find the root cause and understand the context. Do not rely solely on the user's description.
2. **Handoff (Isolation)**: Keep changes isolated. Track progress using files on disk (`task.md`, `implementation_plan.md`) to isolate tasks.
3. **Verification (Generator-Evaluator Split)**:
   - **Maker (Generator)**: Propose and write the code changes.
   - **Checker (Evaluator)**: A separate, adversarial review step. Assume the code is **broken** until proven otherwise. DO NOT just read the code; **execute it, run tests, run linters, and verify actual behavior**.
   - For complex changes, spawn a dedicated adversarial reviewer subagent (`research` or a custom defined subagent) to criticize the code and look for edge cases.
4. **Persistence (State on Disk)**: Maintain progress in `task.md` and state files. Do not keep memory only in the conversation context.
5. **Scheduling (Iterative Looping)**: Iterate on generation and verification in a loop until the stop condition is fully met (all tests pass, lint is clean, all edge cases are verified). Set a maximum iteration limit (e.g., 5 turns) to prevent token blowout.

---

## Generator-Evaluator Split Protocol

When editing or writing code, you must explicitly separate the roles of writing and judging:

```
[Generator: Proposes code] ---> [Evaluator: Skeptical Reviewer]
                                     |
                                     v
                           Acts & Verifies (Runs tests/lint)
                                     |
                   +-----------------+-----------------+
                   | (Fail)                            | (Pass)
                   v                                   v
             Reject + Reasons                    Stop Condition Met
                   |                                   |
                   v                                   v
          Loop back to Generator                 Human Checkpoint
```

### 1. The Generator (Maker)
- Designs the solution, drafts the `implementation_plan.md`.
- Implements the changes across the target files.

### 2. The Evaluator (Checker)
- Default stance: **Doubt, not trust**. Assume the implementation contains subtle bugs, unhandled edge cases, or regression risks.
- Validation by Action: Never accept "it looks correct." The Evaluator must:
  - Run the test suite or compile commands.
  - Run static analysis / linters.
  - Test edge cases (null/empty inputs, boundary conditions, performance, etc.).
- If a verification step fails, report the exact error back to the Generator for the next iteration of the loop.

---

## Operational Discipline (Three Rules of the Loop)

1. **Read a Sample, Always**: Explain every code change clearly and concisely in your walkthrough. Ensure your mental model of the codebase is updated with every change.
2. **Cap Before You Ship**: Prevent infinite loops. Set a maximum loop limit (e.g., 5 iterations) for automated fixes.
3. **Keep One Door Open (Human Checkpoint)**: Pause and ask for user approval at the key boundary (the implementation plan) and present verification results clearly at the end.
