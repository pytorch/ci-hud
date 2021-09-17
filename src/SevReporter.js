// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import { Component } from "react";
import AuthorizeGitHub from "./AuthorizeGitHub.js";

import { github } from "./utils.js";

function getIssuesQuery() {
  return `
      {
        search(type:ISSUE,first:100,query:"is:open is:issue label:\\\"ci: sev\\\"") {
          nodes {
            ... on Issue {
              number
              title
              body
              url
            }
          }
        }
      }
    `;
}

export default class PrDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = {
      sevs: [],
    };
  }

  componentDidMount() {
    this.update();
  }

  async update() {
    if (!localStorage.getItem("gh_pat")) {
      // Not logged in, can't search GitHub
      // TODO: Show login option
      console.log("not logged in, can't fetch sevs");
      return;
    }
    const response = await github.graphql_raw(getIssuesQuery());
    if (response.errors) {
      console.error("failed to fetch sevs");
      console.error(response);
      return;
    }
    this.state.sevs = response.data.search.nodes;

    this.setState(this.state);
  }

  renderSev(issue) {
    return (
      <div className="sevbox">
        <a href="https://github.com/pytorch/pytorch/wiki/%5BWIP%5D-What-is-a-SEV">
          SEV:
        </a>{" "}
        {issue.title} (<a href={issue.url}>#{issue.number}</a>)
      </div>
    );
  }

  render() {
    const existingSevs = this.state.sevs;
    const renderedSevs = [];
    for (const [index, sev] of existingSevs.entries()) {
      renderedSevs.push(<div key={`sev-${index}`}>{this.renderSev(sev)}</div>);
    }

    return <div>{renderedSevs}</div>;
  }
}
