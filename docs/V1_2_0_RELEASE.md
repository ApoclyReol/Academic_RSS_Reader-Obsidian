# Academic RSS Reader v1.2.0

Version 1.2.0 upgrades localization, personalized recommendations, and feed delivery while preserving the explicit Vault-relative database lifecycle and the Obsidian 1.11.4 minimum version.

## Localization

- UI messages use stable semantic keys in complete English and Simplified Chinese locale modules.
- Named interpolation, plural selection, locale-aware numbers, and locale-aware dates are available through the shared i18n runtime.
- CI rejects mismatched locale keys, unknown translation calls, remaining `tx()` calls, and direct literals passed to common UI text methods.

## Recommendations

- TF-IDF vectors are sparse and logistic regression runs in an inline Web Worker with an intercept, class weights, and L2 regularization.
- A deterministic stratified 80/20 holdout reports simple accuracy and suggests a 20-point uncertainty band around the best cutoff. Small datasets fall back to 30/70.
- Manual thresholds override model suggestions. The model records its training hash and feature version, skips unchanged training, and only rescans changed unread papers when possible.
- Text, authors, journals, feed names, and publication freshness contribute to ranking. Explanations keep the strongest positive and negative contributions separately.
- Sparse width detection uses bounded-memory iteration, and scoring visits only terms present in each paper. A 5,000-paper by 120-feature regression case is covered to prevent the previous argument-spread stack overflow.
- The keyword editor provides a colored stopword/enable action on every row and no longer exposes manual weight overrides. Chinese segmentation no longer produces spaced Chinese bigrams, conservative frequency/class-neutral filtering removes uninformative automatic terms, and user-disabled terms remain disabled across model rebuilds.
- Every completed feed-update batch now refreshes recommendations automatically. Stable training data reuses the existing model and scores only new or changed unread items.

## Feed updates

- Feed validators persist ETag and Last-Modified values and treat HTTP 304 as a successful check.
- Updates run with four global slots and one slot per hostname.
- Retry-After, retryable status handling, a 20-second scheduler timeout, cancellation, and health tracking reduce unnecessary source traffic.
- Automatic updates back off for 6, 24, or 72 hours after 3, 5, or 8 consecutive failures. Manual updates remain available.

Obsidian `requestUrl()` cannot abort an HTTP request already sent. Cancellation stops queued work, retries, parsing, and database writes, and ignores late responses.
