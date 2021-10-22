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
import GitHubOverview from "./GitHubOverview.js";
import AuthorizeGitHub from "./AuthorizeGitHub.js";
import SevReporter from "./SevReporter.js";
import Links from "./Links.js";
import {
  BrowserRouter as Router,
  Route,
  Redirect,
  Switch,
} from "react-router-dom";

const App = () => (
  <Router>
    <div className="App">
      <Links />
      <div style={{ margin: "0" }} className="container">
        <SevReporter />
        <Switch>
          <Route path="/build" component={BuildRoute} />
          <Route path="/build1" component={Build1Route} />
          <Route
            path="/pytorch/pytorch/pull/:segment"
            render={(props) => {
              return <Redirect to={`/pr/${props.match.params.segment}`} />;
            }}
          ></Route>
          <Route
            path="/pytorch/pytorch/pull/*/commits/:segment"
            render={(props) => {
              return <Redirect to={`/commit/${props.match.params.segment}`} />;
            }}
          ></Route>
          <Route
            path="/pytorch/pytorch/commit/:segment"
            render={(props) => {
              return <Redirect to={`/commit/${props.match.params.segment}`} />;
            }}
          ></Route>
          <Route
            path="/ci/:user/:repo/:branch+"
            render={(props) => {
              const query = new URLSearchParams(window.location.search);
              const params = props.match.params;
              return (
                <GitHubStatusDisplay
                  interval={60000}
                  repo={params.repo}
                  user={params.user}
                  branch={params.branch}
                  jobNameFilter={query.get("name_filter")}
                />
              );
            }}
          ></Route>
          <Route
            path="/overview"
            render={() => {
              return <GitHubOverview />;
            }}
          />
          <Route
            path="/pr/:user/:repo/:number"
            render={(props) => {
              const params = props.match.params;
              return (
                <PrDisplay
                  pr_number={params.number}
                  user={params.user}
                  repo={params.repo}
                />
              );
            }}
          />
          <Route
            path="/pr/:number"
            render={(props) => {
              return (
                <Redirect
                  to={`/pr/pytorch/pytorch/${props.match.params.number}`}
                />
              );
            }}
          />
          <Route
            path="/commit/:user/:repo/:commit"
            render={(props) => {
              const params = props.match.params;
              return (
                <PrDisplay
                  commit_hash={params.commit}
                  user={params.user}
                  repo={params.repo}
                />
              );
            }}
          />
          <Route
            path="/commit/:commit"
            render={(props) => {
              return (
                <Redirect
                  to={`/commit/pytorch/pytorch/${props.match.params.commit}`}
                />
              );
            }}
          />
          <Route
            path="/build2/:segment"
            render={(props) => {
              const branch = props.match.params.segment.replace("pytorch-", "");
              return <Redirect to={`/ci/pytorch/pytorch/${branch}`} />;
            }}
          />
          <Route
            path="/build3/:segment"
            render={(props) => {
              const branch = props.match.params.segment.replace("pytorch-", "");
              return <Redirect to={`/ci/pytorch/pytorch/${branch}`} />;
            }}
          />
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

const RouteNotFound = ({ match }) => {
  return <p>Route not found: {match.url}</p>;
};

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

const TorchBenchRoute = ({ match }) => (
  <Fragment>
    <Route exact path={match.url} component={PerfHistoryDisplay} />
  </Fragment>
);

export default App;
