# EP-MB2-02 Device Identity

## Physical Identity

Device physical identity is represented by:

- provider id;
- provider instance id;
- device kind;
- provider-local device id;
- derived physical device id;
- identity evidence.

## Accepted Identity

Accepted physical identity requires:

- non-empty device id;
- supported device kind;
- provider authorization through Device Runtime;
- health snapshot source from active provider instance.

## Rejected Identity

Rejected cases:

- empty device id: `INVALID_PHYSICAL_IDENTITY`;
- unsupported formal Device Runtime kind such as `SCALE`: `UNSUPPORTED_DEVICE_KIND`;
- stale provider health source: `STALE_PROVIDER_INSTANCE`.

## Hardware Facts

VID, PID, COM, driver, and queue identity are outside this package.
