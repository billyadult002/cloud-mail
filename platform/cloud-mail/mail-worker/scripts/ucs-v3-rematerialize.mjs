// Production V3 is intentionally native-Worker-only. This former CLI entry
// point bypassed Worker telemetry and did not preserve native D1 batch semantics.
// Use the fenced scheduled handler; never create a competing V3 writer.
throw new Error('ucs_v3_local_adapter_disabled_use_native_scheduled_worker');
