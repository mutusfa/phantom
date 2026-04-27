# Principles

Distilled strategic principles from session observations.

- Test iteratively and incrementally: smaller group-specific evals reveal more than broad sweeps (session 1776257294 on llm-receipt-reading showed value of --mapping-group-id filtering)
- Model switching requires recompilation of tuning artifacts (DSPy instructions), not just config changes
- Vision-specialized models (like DeepSeek OCR) respond better to minimal prompts than complex instructions; instruction tuning may be ineffective for vision-heavy tasks
- Do not optimize for gains under ~5%: pragmatic cost/benefit assessment. Won't invest in infra for marginal improvements when opportunity cost exists elsewhere
- Before proposing retailer tuning, analyze error split: distinguish model-fixable errors from capture-side and format-ambiguity issues. If the latter dominates, defer tuning and wait for stronger base models rather than burn DSPy optimization budget.
