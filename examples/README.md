# Examples

Every example here runs against the **published** packages from npm, not the
local source. If an example does not work for a stranger, it is not an example.

## `incident-forensics.mjs`

The question ABSuite exists to answer:

> *Our AI agent approved $250,000 of transactions at 2:14 AM. What happened?*

```bash
npm install @absuitecore/capkit @absuitecore/trust
node incident-forensics.mjs
```

It walks the whole investigation in about forty lines:

- the signature verifies, so the record is genuine;
- the capability permitted approvals and **not** refunds;
- the agent's written justification is checked against the policy, and the
  claim that the CEO approved it comes back `UNVERIFIED`;
- editing the stored record breaks the chain and names the offending sequence
  number.

The conclusion is the sentence worth remembering:

> The agent did not exceed its permissions. It exceeded its evidence.

## Contributing an example

Good examples answer a question someone actually has. Before opening a pull
request, please make sure it:

1. installs from npm rather than importing from `../packages`;
2. runs start to finish with `node <file>` and no configuration;
3. prints output a reader can follow without knowing the codebase;
4. makes no claim the code does not demonstrate — if the tool prints
   `UNVERIFIED`, the surrounding prose must not say "verified".

That last one is not a style note. An earlier draft of the forensics example
claimed a figure was "supported by the policy" while the tool printed
`missing: $250,000` three lines above. A demo for an evidence product must not
contain an unsupported claim.
