# EP-MB2-02 Device Slot Reference

## Cloud SoT

Cloud remains the only source of truth for Device Slot Definition.

Device Runtime accepts only a local `HrtDeviceSlotReference`.

## Runtime Reference Fields

- slot id;
- store id;
- terminal id;
- expected device kind;
- required capabilities;
- scope;
- revision.

## Runtime Responsibility

Device Runtime uses slot references for:

- assignment validation;
- scope matching;
- command/source/target eligibility.

It does not define or persist Cloud Slot.
