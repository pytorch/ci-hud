// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Fragment } from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import ComputerDisplay from "./ComputerDisplay.js";
import QueueDisplay from "./QueueDisplay.js";
import BuildHistoryDisplay from "./BuildHistoryDisplay.js";
import GitHubStatusDisplay from "./GitHubStatusDisplay.js";
import PerfHistoryDisplay from "./PerfHistoryDisplay.js";
import PrDisplay from "./PrDisplay.js";
import JobCorrelationHeatmap from "./JobCorrelationHeatmap.js";
import GitHubActionsDisplay from "./GitHubActionsDisplay.js";
import AuthorizeGitHub from "./AuthorizeGitHub.js";
import SevReporter from "./SevReporter.js";
import {
  BrowserRouter as Router,
  Route,
  Link,
  Redirect,
  Switch,
} from "react-router-dom";

const App = () => (
  <Router basename={process.env.PUBLIC_URL + "/"}>
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">
          <Link to="/">hud.pytorch.org</Link>
        </h1>
      </header>
      <ul className="menu">
        <li>New-style:</li>
        {["pytorch"].map((e) => (
          <Fragment key={e}>
            {["master", "nightly", "release/1.9"].map((trigger) => (
              <li key={`${e}-${trigger}`}>
                <Link to={`/build2/${e}-${trigger}`}>
                  {e}-{trigger}
                </Link>
              </li>
            ))}
          </Fragment>
        ))}
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
                    <Link to={"/build1/" + e + "-" + trigger + "?mode=binary"}>
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
            <Link to={"/build1/nightlies-uploaded"}>nightlies-uploaded</Link>
          </li>
        </Fragment>
      </ul>
      <SevReporter />
      <Switch>
        <Route path="/build" component={BuildRoute} />
        <Route path="/build1" component={Build1Route} />
        <Route path="/pr" component={PrRoute} />
        <Route path="/commit/:segment" component={CommitPage} />
        <Route path="/build2" component={Build2Route} />
        <Route path="/torchbench-v0-nightly" component={TorchBenchRoute} />
        <Route path="/github_logout" component={LogoutGitHub} />
        <Route path="/authorize_github" component={AuthorizeGithubRoute} />
        <Route path="/status" component={Status} />
        <Route exact path="/">
          <Redirect to="/build2/pytorch-master" />
        </Route>
        <Route path="*" exact={true} component={RouteNotFound} />
      </Switch>
    </div>
  </Router>
);

//    <ul className="menu">
//      {[
//       "linux-trusty-py2.7-trigger",
//       "linux-trusty-py2.7.9-trigger",
//       "linux-trusty-py3.5-trigger",
//       "linux-trusty-py3.6-gcc4.8-trigger",
//       "linux-trusty-py3.6-gcc5.4-trigger",
//       "linux-trusty-py3.6-gcc7.2-trigger",
//       "linux-trusty-pynightly-trigger",
//       "linux-xenial-cuda8-cudnn6-py3-trigger",
//       "linux-xenial-cuda9-cudnn7-py2-trigger",
//       "linux-xenial-cuda9-cudnn7-py3-trigger",
//       "linux-xenial-py3-clang5-asan-trigger",
//       "win-ws2016-cuda9-cudnn7-py3-trigger",
//      ].map((e) => <li key={e}><Link to={"/build/pytorch-builds/job/pytorch-" + e}>{e}</Link></li>)}
//    </ul>

const Status = () => (
  <div>
    <GitHubActionsDisplay />
    <JobCorrelationHeatmap />
    <QueueDisplay interval={1000} />
    <ComputerDisplay interval={1000} />
  </div>
);

const AuthorizeGithubRoute = () => {
  return <AuthorizeGitHub />;
};

const LogoutGitHub = () => {
  localStorage.removeItem("gh_pat");
  console.log("logged out");
  return <Redirect to="/"></Redirect>;
};

const Build = ({ match }) => {
  // Uhhh, am I really supposed to rob window.location here?
  const query = new URLSearchParams(window.location.search);
  return (
    <BuildHistoryDisplay
      interval={60000}
      job={match.url.replace(/^\/build\//, "")}
      mode={query.get("mode")}
    />
  );
};

const Build1 = ({ match }) => {
  // Uhhh, am I really supposed to rob window.location here?
  const query = new URLSearchParams(window.location.search);
  return (
    <BuildHistoryDisplay
      interval={60000}
      job={match.url.replace(/^\/build1\//, "")}
      mode={query.get("mode")}
    />
  );
};

const Build2 = ({ match }) => {
  // Uhhh, am I really supposed to rob window.location here?
  const query = new URLSearchParams(window.location.search);
  return (
    <GitHubStatusDisplay
      interval={60000}
      job={match.url.replace(/^\/build2\//, "")}
      mode={query.get("mode")}
    />
  );
};

const PrPage = ({ match }) => {
  return <PrDisplay pr_number={parseInt(match.url.replace(/^\/pr\//, ""))} />;
};

const PrRoute = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={PrPage} />
    <Route path={`${match.url}/:segment`} component={PrRoute} />
  </Fragment>
);

const CommitPage = ({ match }) => {
  return <PrDisplay commit_hash={match.url.replace(/^\/commit\//, "")} />;
};

const RouteNotFound = ({ match }) => {
  return <p>Route not found: {match.url}</p>;
};

const CommitRoute = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={CommitPage} />
    <Route path={`${match.url}/:segment`} component={CommitRoute} />
  </Fragment>
);

const BuildRoute = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={Build} />
    <Route path={`${match.url}/:segment`} component={BuildRoute} />
  </Fragment>
);

const Build1Route = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={Build1} />
    <Route path={`${match.url}/:segment`} component={Build1Route} />
  </Fragment>
);

const Build2Route = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={Build2} />
    <Route path={`${match.url}/:segment`} component={Build2Route} />
  </Fragment>
);

const TorchBenchRoute = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={PerfHistoryDisplay} />
  </Fragment>
);

export default App;
