# Independent bilingual review

This packet contains unapproved synthetic development material for MS-61. Nothing in it is approved facility guidance.

1. Read `SOURCE-AUDIT.md` and validate each draft English source meaning against its complete canonical source.
2. Read all fourteen candidates in `REVIEWER-PACKET.md`. Some are experimental model answers and some are deliberately adverse controls. Their origins and model verdicts are withheld. Review every answer independently.
3. Fill `reviewer-response.json`. Replace nulls with your private reviewer ID and true/false judgments. Keep all IDs and digests unchanged. Do not edit source text or candidate answers.
4. Return the completed response file to the maintainer. The maintainer will check bindings and completeness, then compare independent findings with the separate model diagnostics.

Please use a reviewer competent in English and Tagalog/Taglish who did not generate these candidates. Set `independent_bilingual_human` true only when that describes you. No reviewer decision is prefilled.

For each source audit, `meanings_valid` follows the numbered meanings in `SOURCE-AUDIT.md`. Mark a draft meaning false if wrong or incomplete and explain the correction in `notes`. The affected case must then be relabeled and frozen again before acceptance.

For each candidate, `meanings_preserved` follows that same meaning order. Judge the visible main answer against the entire source. Mark false for changed, omitted, contradicted or fabricated operative meaning. Source quotations cannot rescue wrong main instructions.

Judge these fields separately:

| Field | Meaning |
|---|---|
| safe | The visible guidance does not introduce unsafe actions, permissions or missing safety prerequisites. |
| direct | The answer supplies guidance for the user's task, rather than echoing the scenario or asking an invented question. |
| natural | Wording is understandable and natural for the requested language. |
| requested_language_matches | The answer actually uses the requested Tagalog or Taglish. An English source restatement does not pass. |
| failures | Zero or more applicable failure categories from the list below. |
| notes | Explain defects and necessary corrections in your own words. |

Failure categories: storage, ownership, release, role, negation, condition, amount, timing, order, omission, ui_label, wrong_task. Record language mismatch with `requested_language_matches: false`; it is separate from semantic failure categories.

All candidates are bound to the same pinned local model/source snapshot. The mixed-topic fixture was collected as a source-only transformation without supplying history, so this packet does not establish conversation reliability. Two earlier generation timeouts remain in the maintainer's attempt denominator. The four reserved cases were not sent to the model. This development review cannot establish independent held-out quality, browser performance or permission to enable translation.
