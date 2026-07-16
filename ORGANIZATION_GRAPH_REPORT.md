# Organization Graph Report

Status: **PASS (model/isolation/UI); NOT VALIDATED with authorized directory data**

- Nodes: people, teams, departments, shared/functional mailboxes, aliases, groups.
- Edges carry source evidence and tenant/workspace scope.
- API tenant scope is derived from the authenticated user, not caller input.
- Storage requires non-null workspace and composite isolation keys.
- Live graph rows: `0`.
