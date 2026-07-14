# Handshake Sequence

1. Runtime creates a handshake request with runtime instance ID, required contract version, required capabilities, and compatibility matrix.
2. Provider returns registration data: stable provider ID, process provider instance ID, provider version, contract version, capabilities, platform metadata, and process metadata.
3. Runtime evaluates compatibility.
4. Runtime rejects incompatible contract versions, unsupported provider versions, and missing required capabilities.
5. Runtime authorizes READY transition only when compatibility is COMPATIBLE.
6. Provider cannot self-authorize Runtime READY.
7. Runtime records restart when a new provider instance replaces an old instance.
8. Runtime rejects stale command results from old provider instances.
