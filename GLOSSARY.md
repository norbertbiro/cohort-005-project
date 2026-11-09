# Cadence

Cadence is a course platform. Instructors publish courses, and Students buy them to learn.

## Language

### People

**Student**:
A person who buys or takes courses.
_Avoid_: Learner

**Admin**:
A person who runs the Cadence platform. Only this role is called Admin.
_Avoid_: admin (for the team role)

**Team Admin**:
A person who manages a team's Seats. A Team Admin is not an Admin.
_Avoid_: admin, team owner

### Buying and refunds

**Purchase**:
One payment that buys one course. It never renews.
_Avoid_: Subscription, order

**Team Purchase**:
A Purchase that buys several Seats in one course for a team.

**Seat**:
One place in a Team Purchase. One Student gets access to the course through it. A refunded Seat can never be claimed again.
_Avoid_: Coupon, licence

**Seat Code**:
The code a Student uses to claim a Seat.
_Avoid_: Coupon code

**Claim**:
To take a Seat with its Seat Code. A claimed Seat belongs to one Student.
_Avoid_: Redeem

**Enrollment**:
One Student's access to one course, gained through a Purchase or a claimed Seat.
_Avoid_: Access, membership

**Refund Request**:
An ask to hand back a Purchase and get the money back. For a Team Purchase, the Team Admin asks for one or more of its Seats. An Admin approves or declines the whole request.
_Avoid_: Cancellation, cancel, Reversal, Chargeback

**Refund**:
Money given back after a Refund Request is approved: the amount paid on the Purchase, or each Seat's equal share of it. It ends the Enrollment of the Student involved. A declined Refund Request has no Refund.
_Avoid_: Reversal, chargeback

**Chargeback**:
A dispute about a payment that the cardholder raises through their bank, outside Cadence. It is never a Refund Request.
