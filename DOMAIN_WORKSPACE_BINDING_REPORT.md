# Domain Workspace Binding

`workspace_domains.domain` is unique and has a required workspace foreign key. `assertMailboxWorkspace` rejects custom-domain mailbox provisioning when no workspace owns the domain.
