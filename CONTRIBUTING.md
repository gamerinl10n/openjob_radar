# Contributing

OpenJob Radar accepts fixes for existing sources and new public job-board adapters.

## Development

```bash
npm ci
npm test
npm run check
```

## Pull requests

- Keep collection manual and review-first. Do not add scheduled or automatic publishing.
- Access only public source pages; do not bypass authentication or access controls.
- Add fixtures or mocked responses for normal, empty, changed, and failed source responses.
- Preserve request limits, response-size limits, safe redirect handling, and source URLs.
- Do not commit copied job documents, credentials, personal data, or generated review files containing sensitive data.
- Confirm the source's terms and robots policy before adding an adapter.

By contributing, you agree that your contribution is licensed under the MIT License.
