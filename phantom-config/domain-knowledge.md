# Domain Knowledge

Accumulated domain expertise from interactions.

## llm-receipt-reading (receipt extraction pipeline)

- Production volume: 20k receipts/day, mission-critical for cost optimization
- Current model chain: Gemini flash-lite as primary, flash-lite-preview and flash as fallbacks (2.5% and 20% of calls)
- Cost: Gemini flash-lite ~$3.58 per 1,000 receipts; Gemma 4 26B via OpenRouter ~$2.15/1k; self-hosted Gemma ~$0.94/1k (with ~$350-500/mo GPU)
- Tuning strategy: DSPy (version 3.1.3) with GEPA/MIPROv2 for instruction optimization; must recompile against new model when switching
- Demo selection is the primary performance lever: 30-40% of metadata performance is driven by prompt + demos chosen by DSPy; currently evaluates ~30 demo candidates, could be more principled about filtering candidates
- Known Gemma weakness: single-digit OCR misreads on Lidl till counters (e.g., 6→8, 6→5), not fixable by prompting or improved instructions
- DeepSeek OCR: vision-only model that outputs template garbage with complex instructions; requires minimal prompt ("OCR:" only); tuning instructions doesn't help (model ignores text)
- Eval framework: `evaluate_retailer.py` with group-specific filtering (--mapping-group-id, --limit 100), produces JSONL per-receipt results and JSON summaries
