# pi-leetcode

A LeetCode practice and learning workflow for Pi Coding Agent, helping users understand algorithms and solve interview problems independently.

## Status

This project is in the planning stage. The extension and commands below are not implemented yet.

## Goals

- Bring problem selection, local testing, and submission into Pi.
- Provide an in-Pi workbench for reading problems, editing solutions, inspecting results, and asking the agent for help.
- Create a default practice workspace on first use, with an optional custom directory.
- Use one practice workflow with configurable proactive guidance: independent practice, light guidance, or step-by-step coaching.
- Adapt questions and hints to the learner's current understanding, with light guidance as the default.
- Let users request any depth of help at any guidance level, including a complete explanation.
- Support an agent-driven solve and debug workflow when explicitly requested.
- Keep execution results and trajectories useful for future agent evaluation.

## Initial command plan

| Command | Planned behavior |
| --- | --- |
| `/leet` | Initialize on first use and enter the practice workbench. |
| `/leet pick` | Select a problem by ID, daily challenge, or difficulty. |
| `/leet open` | Open the problem statement and prepare a local solution workspace. |
| `/leet test` | Run test cases and give feedback according to the selected guidance level. |
| `/leet hint` | Provide progressive hints without revealing the full solution by default. |
| `/leet submit` | Submit the solution and report the judge result. |

Guidance selection, natural-language adjustments, and practice review are part of the product design; their command syntax is still to be defined. There are no separate learning and practice modes.

Practice files persist on disk, while the workbench provides the primary reading and editing experience. Users do not need to create a project or open Markdown files manually.

See [the product design](docs/product-design.md) for the agreed workflow, workbench, storage behavior, and guidance rules.

The proposed implementation is a TypeScript Pi extension bundled with a teaching skill. Go is the proposed first solution language. Authentication, API integration, language support, and the test runner will be designed before implementation.

## Development

No installation or build commands are available yet. The next step is to prototype the workbench and its transitions between problem reading, solution editing, results, and the Pi conversation, then define the platform integration.
