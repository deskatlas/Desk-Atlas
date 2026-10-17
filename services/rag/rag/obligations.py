"""MS59-TC06/19: original requested details, not model search rewrites."""
import re


def amount_requested(query):
    return bool(re.search(r'\b(?:how much|magkano|amount|refund rate|cancellation fee)\b', query, re.I))


def has_amount_rule(text):
    # Section numbers and list numbering are not money. Qualitative full/zero
    # refund rules can answer an amount question; the semantic check still runs.
    return bool(re.search(r'(?:[$₱€£]\s*\d|\b(?:PHP|USD|pesos?|dollars?)\s*\d|\d[\d,.]*\s*(?:%|percent|pesos?|PHP|USD|dollars?)(?=\s|$|[.,;])|\b(?:full|no|zero|non[- ]?)\s*refunds?\b)', text, re.I))
