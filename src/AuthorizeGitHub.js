// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";

const AUTH_SERVER = "https://auth.pytorch.org";

export default class AuthorizeGitHub extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loggedin: !!localStorage.getItem("gh_pat"),
    };
  }
  componentDidMount() {
    this.update();
  }

  async update() {
    let url = new URL(window.location.href);
    let code = url.searchParams.get("code");
    if (!code) {
      return;
    }
    this.state.code = code;
    let errorMsg = "bad code passed to GitHub OAuth, sign into GitHub again";
    let result = await fetch(`${AUTH_SERVER}/authenticate/${code}`).then((r) =>
      r.json()
    ).catch((error) => {
      errorMsg = "Error happened while communicating to auth server: " + error;
      return {token: null};
    });
    if (!result.token) {
      alert(errorMsg);
    } else {
      localStorage.setItem("gh_pat", result.token);
      this.state.loggedin = true;
    }
    this.setState(this.state);

    // GitHub redirects back to a URL with just a ?code=... parameter, so store
    // off to the side the place to go once logged in
    const lastRedirect = localStorage.getItem("last_redirect");
    if (lastRedirect) {
      localStorage.removeItem("last_redirect");
      if (lastRedirect != window.location.href) {
        window.location.href = lastRedirect;
      }
    }
  }

  render() {
    const existingToken = localStorage.getItem("gh_pat");
    if (existingToken) {
      return (
        <div>
          <a href="/github_logout">Log out</a>
        </div>
      );
    }
    if (!this.state.code) {
      return (
        <div>
          <a href="https://github.com/login/oauth/authorize?scope=public_repo&client_id=7e8b4df19d85405ac1b2">
            Click here
          </a>{" "}
          to sign in to GitHub
        </div>
      );
    }
    return (
      <div>
        <p>Loading...</p>
      </div>
    );
  }
}
