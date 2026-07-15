# EP-MB2-02 Device Health

## Health View

Device health view contains:

- health;
- source provider instance id;
- last updated timestamp;
- stale marker.

## Provider Health Separation

Provider health remains owned by Provider Runtime.

Device health is accepted only from the active provider instance and only updates registered device views.

## Stale Health

When provider ownership becomes stale, device health view is marked stale. This does not merge health with assignment or ownership state.
