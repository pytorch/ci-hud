export function getStatusUrl(user, repo, branch) {
  return `https://s3.amazonaws.com/ossci-job-status/v6/${user}/${repo}/${branch.replace(
    "/",
    "_"
  )}.json`;
}

export function getLinkUrl(user, repo, branch) {
  return `/ci/${user}/${repo}/${branch}/`;
}
