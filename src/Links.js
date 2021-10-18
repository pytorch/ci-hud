// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component, Fragment } from "react";
import { AiFillGithub } from "react-icons/ai";
import { BiHelpCircle } from "react-icons/bi";
import { Link } from "react-router-dom";
import AuthorizeGitHub from "./AuthorizeGitHub";

const AUTH_SERVER = "https://auth.pytorch.org";

export default class Links extends Component {
  constructor(props) {
    super(props);
    this.state = {
      showMore: false,
    };
  }

  render() {
    let more = null;
    if (this.state.showMore) {
      more = (
        <div>
          <ul className="menu">
            {["torchbench-v0-nightly", "status"].map((e) => (
              <li key={`${e}`}>
                <Link to={`/${e}`}>{e}</Link>
              </li>
            ))}
          </ul>
          <ul className="deprecated-menu">
            <li>Old-style:</li>
            {[
              "pytorch",
              // "tensorcomp",
              // "translate",
              "rocm-pytorch",
            ].map((e) => (
              <Fragment key={e}>
                {["master", "pull-request"].map((trigger) => (
                  <li key={e + "-" + trigger}>
                    <Link to={"/build1/" + e + "-" + trigger}>
                      {e}-{trigger}
                    </Link>
                    &nbsp; (
                    <Link to={"/build1/" + e + "-" + trigger + "?mode=perf"}>
                      perf
                    </Link>
                    /
                    <Link to={"/build1/" + e + "-" + trigger + "?mode=cost"}>
                      cost
                    </Link>
                    {e === "pytorch" && trigger === "master" ? (
                      <Fragment>
                        /
                        <Link
                          to={"/build1/" + e + "-" + trigger + "?mode=binary"}
                        >
                          binary
                        </Link>
                      </Fragment>
                    ) : (
                      <Fragment />
                    )}
                    )
                  </li>
                ))}
              </Fragment>
            ))}
            <Fragment key="nightlies-uploaded">
              <li>
                <Link to={"/build1/nightlies-uploaded"}>
                  nightlies-uploaded
                </Link>
              </li>
            </Fragment>
          </ul>
        </div>
      );
    }
    return (
      <div className="links-container">
        <div className="Links">
          <div style={{ display: "inline" }}>
            <a style={{ fontWeight: "bold" }} href="https://hud.pytorch.org">
              PyTorch CI HUD
            </a>
            <ul style={{ display: "inline" }} className="menu">
              {["pytorch"].map((e) => (
                <Fragment key={e}>
                  {["master", "viable/strict", "nightly", "release/1.10"].map(
                    (branch) => (
                      <li key={`${branch}`}>
                        <Link to={`/ci/pytorch/pytorch/${branch}`}>
                          {branch}
                        </Link>
                      </li>
                    )
                  )}
                </Fragment>
              ))}
              <li>
                <a href="https://metrics.pytorch.org">metrics</a>
              </li>
              <li>
                <a
                  href="more"
                  onClick={(e) => {
                    e.preventDefault();
                    this.state.showMore = !this.state.showMore;
                    this.setState(this.state);
                    return false;
                  }}
                >
                  {this.state.showMore ? "less" : "more"}
                </a>
              </li>
            </ul>
          </div>
          <div
            style={{
              display: "inline",
              marginLeft: "auto",
              marginRight: "0px",
            }}
          >
            <ul style={{ marginBottom: "0" }} className="menu">
              <li>
                <a href="https://github.com/pytorch/pytorch/wiki/Using-hud.pytorch.org">
                  help
                </a>
              </li>
              <li>
                <a href="https://github.com/pytorch/pytorch-ci-hud/issues/new">
                  requests
                </a>
              </li>
              <li>
                <AuthorizeGitHub />
              </li>
              <li>
                <a
                  style={{ color: "black" }}
                  href="https://github.com/pytorch/pytorch-ci-hud"
                >
                  <AiFillGithub />
                </a>
              </li>
            </ul>
          </div>
        </div>
        {more}
      </div>
    );
  }
}
