#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_contact_autocomplete_guard", {
    "files/GlassMail-project/GlassMail/Services/ContactSuggestionProvider.swift": ["ContactSuggestionProvider", "loadSuggestions", "search(query:"],
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["ComposeRecipientAutocomplete", "compose-recipient-autocomplete"],
    "files/GlassMail-project/GlassMail/Views/ComposeView.swift": ["contactSuggestionProvider", "applyRecipientSuggestion", "ComposeRecipientAutocomplete"],
})
