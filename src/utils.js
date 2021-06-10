// see https://github.com/qoomon/aws-s3-bucket-browser/blob/937147179a9284dc8d98e7a6d52f60e8fdcd7231/index.html#L430
export function formatBytes(size) {
  if (!size) {
    return "-";
  }
  const KB = 1024;
  if (size < KB) {
    return size + "  B";
  }
  const MB = 1000000;
  if (size < MB) {
    return (size / KB).toFixed(0) + " KB";
  }
  const GB = 1000000000;
  if (size < GB) {
    return (size / MB).toFixed(2) + " MB";
  }
  return (size / GB).toFixed(2) + " GB";
}

// see https://stackoverflow.com/a/19448718
export function parseXml(xml, arrayTags) {
  let dom = null;
  if (window.DOMParser) dom = new DOMParser().parseFromString(xml, "text/xml");
  else if (window.ActiveXObject) {
    dom = new ActiveXObject("Microsoft.XMLDOM");
    dom.async = false;
    if (!dom.loadXML(xml))
      throw dom.parseError.reason + " " + dom.parseError.srcText;
  } else throw new Error("cannot parse xml string!");

  function parseNode(xmlNode, result) {
    if (xmlNode.nodeName == "#text") {
      let v = xmlNode.nodeValue;
      if (v.trim()) result["#text"] = v;
      return;
    }

    let jsonNode = {},
      existing = result[xmlNode.nodeName];
    if (existing) {
      if (!Array.isArray(existing))
        result[xmlNode.nodeName] = [existing, jsonNode];
      else result[xmlNode.nodeName].push(jsonNode);
    } else {
      if (arrayTags && arrayTags.indexOf(xmlNode.nodeName) != -1)
        result[xmlNode.nodeName] = [jsonNode];
      else result[xmlNode.nodeName] = jsonNode;
    }

    if (xmlNode.attributes)
      for (let attribute of xmlNode.attributes)
        jsonNode[attribute.nodeName] = attribute.nodeValue;

    for (let node of xmlNode.childNodes) parseNode(node, jsonNode);
  }

  let result = {};
  for (let node of dom.childNodes) parseNode(node, result);

  return result;
}

export async function asyncAll(functions) {
  // Run a list of arg-less async functions
  let invoked = functions.map((f) => f());
  return await Promise.all(invoked);
}

async function github_graphql(query) {
  // Query the GitHub GraphQL API
  const pat = localStorage.getItem("gh_pat");
  const result = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: "token " + pat,
    },
    body: JSON.stringify({ query: query }),
  });
  return (await result.json()).data;
}

export async function github_json(url) {
  // Query the GitHub JSON API
  const pat = localStorage.getItem("gh_pat");
  const result = await fetch("https://api.github.com/" + url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: "token " + pat,
    },
  });
  return await result.json();
}

export let github = {
  graphql: github_graphql,
  json: github_json,
};

export async function s3(prefix) {
  // List the gha-artifacts S3 bucket by a specific prefix
  return await fetch(
    "https://gha-artifacts.s3.amazonaws.com/?" +
      new URLSearchParams({
        "list-type": 2,
        delimiter: "/",
        prefix: prefix,
        "max-keys": 50,
      })
  )
    .then((a) => a.text())
    .then((a) => parseXml(a));
}
