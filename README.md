# [PyTorch CI HUD](https://hud.pytorch.org)

Visit https://hud.pytorch.org and see https://github.com/pytorch/pytorch/wiki/Using-hud.pytorch.org for usage details.

## Development

This project was bootstrapped with [Create React App](https://create-react-app.dev). To build locally, install dependencies and run in develop mode:

```bash
git clone https://github.com/pytorch/pytorch-ci-hud.git ci-hud
cd ci-hud
yarn install
npm start  # start a development server on localhost:3000
```

The code is routed from [`App.js`](src/App.js) to places like:

- [`PrDisplay.js`](src/PrDisplay.js): handles the per commit/PR pages with test results
- [`GitHubStatusDisplay.js`](src/GitHubStatusDisplay.js): shows status for a set of commits on master or a release branch. This also depends on this [lambda function](https://github.com/pytorch/test-infra/tree/main/aws/lambda/github-status-webhook-handler) to read GitHub [`status`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#status) and [`check_run`](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#check_run) webhooks and store them in S3 as JSON.

### Submitting a PR

Submitting a PR will trigger a [preview build](https://www.netlify.com/products/deploy-previews/) on Netlify so others can preview the changes. Once merged, [GitHub Actions](https://github.com/pytorch/pytorch-ci-hud/blob/main/.github/workflows/ci.yml) will deploy the new site to the [`gh-pages`](https://github.com/pytorch/pytorch-ci-hud/tree/gh-pages) branch.

### Log-ins for Local Development and Deploy Previews

Log-ins don't work on the Netlify deploy previews since the GitHub app has hud.pytorch.org hardcoded as its callback URL. To see changes that require the GitHub API in a preview you can manually copy your OAuth token. In the JS console on hud.pytorch.org, run `localStorage.getItem("gh_pat")`. Then in the preview's console, run `localStorage.setItem("gh_pat", "<the token>")`.

## Data

The data backing the HUD is updated via a series of cron-based GitHub Actions. See [`.github/`](.github) for details.

## License

This repository uses the MIT License, as found in the [LICENSE](LICENSE) file.
