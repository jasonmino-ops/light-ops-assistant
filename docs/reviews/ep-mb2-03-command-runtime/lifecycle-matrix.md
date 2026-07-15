# Lifecycle Matrix

| From | To | Trigger | Allowed |
| --- | --- | --- | --- |
| CREATED | VALIDATING | command received | yes |
| CREATED | CANCELLED | caller cancel before validation | yes |
| VALIDATING | ACCEPTED | validation and resolution passed | yes |
| VALIDATING | REJECTED | validation/resolution rejected | yes |
| VALIDATING | CANCELLED | caller cancel | yes |
| ACCEPTED | DISPATCH_READY | device/provider eligible | yes |
| ACCEPTED | CANCELLED | caller cancel | yes |
| DISPATCH_READY | DISPATCHED | dispatch port called | yes |
| DISPATCH_READY | REJECTED | executor missing or dispatch cannot start | yes |
| DISPATCH_READY | CANCELLED | caller cancel | yes |
| DISPATCHED | EXECUTING | executor accepted | yes |
| DISPATCHED | REJECTED | dispatch rejected | yes |
| DISPATCHED | FAILED | dispatch port failure | yes |
| DISPATCHED | TIMED_OUT | dispatch timeout | yes |
| DISPATCHED | CANCELLED | caller cancel | yes |
| EXECUTING | SUCCEEDED | execution success | yes |
| EXECUTING | FAILED | execution failed | yes |
| EXECUTING | TIMED_OUT | execution timeout | yes |
| EXECUTING | CANCELLED | caller cancel | yes |
| REJECTED | any | retry or mutation | no |
| SUCCEEDED | any | retry or mutation | no |
| FAILED | any | retry or mutation | no |
| TIMED_OUT | any | retry or mutation | no |
| CANCELLED | any | retry or mutation | no |

Terminal states: `REJECTED`, `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `CANCELLED`.
