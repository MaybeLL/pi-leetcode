# pi-leetcode

An agent-native LeetCode workflow for Pi Coding Agent.

## Status

This project is in the planning stage. The extension and commands below are not implemented yet.

## Goals

- Bring problem selection, local testing, and submission into Pi.
- Support guided practice with progressive hints, letting the learner write the solution.
- Support an agent-driven solve and debug workflow when explicitly requested.
- Keep execution results and trajectories useful for future agent evaluation.

## Initial command plan

| Command | Planned behavior |
| --- | --- |
| `/leet pick` | Select a problem by ID, daily challenge, or difficulty. |
| `/leet open` | Open the problem statement and prepare a local solution workspace. |
| `/leet test` | Run test cases and explain failures. |
| `/leet hint` | Provide progressive hints without revealing the full solution by default. |
| `/leet submit` | Submit the solution and report the judge result. |

The initial direction is a TypeScript Pi extension, with Go as the first solution language. Authentication, API integration, and the local test runner will be designed before implementation.

## Development

No installation or build commands are available yet. The next step is to define the extension interface and implement a minimal problem-to-workspace workflow.
