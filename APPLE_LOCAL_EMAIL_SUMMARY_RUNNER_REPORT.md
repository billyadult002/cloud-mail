# Apple Local Email Summary Runner Report

Date: 2026-07-06

## Runner

Email Detail AI Briefing uses `AppState.triageLocalStrict(_:force:)` as the Apple-local summary runner.

## Fix

The strict runner now treats an empty Apple Intelligence summary as a failure:

`Apple Intelligence returned an empty summary. Try again.`

The timeout message is:

`Apple Intelligence summary timed out. Try again.`

## Provider Boundary

This path remains Apple-local for Email Detail AI Briefing / Summarize. Gemini and ChatGPT Local Broker status paths are preserved for AI Center optional/status use.

