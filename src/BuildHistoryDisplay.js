import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job } from './Summarize.js';

// Ideas:
//  - Put the master and pull request info together, so you can see what
//  the reported 'master' status is for a given 'pull-request' build

export default class BuildHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = this.initialState();
  }
  initialState() {
    return { builds: [], currentTime: new Date(), updateTime: new Date(0) };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
  }
  componentDidUpdate(prevProps) {
    if (this.props.job !== prevProps.job) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async update() {
    this.setState({currentTime: new Date()});
    const data = await jenkins.job(this.props.job, {depth: 1});
    data.updateTime = new Date();
    // TODO: This can cause spurious state updates
    this.setState(data);
  }
  render() {
    function result_icon(result) {
      if (result === 'SUCCESS') return <span role="img" aria-label="passed">✅</span>;
      if (result === 'FAILURE') return <span role="img" aria-label="failed">❌</span>;
      if (result === 'ABORTED') return <span role="img" aria-label="cancelled">⚪</span>;
      if (!result) return <span className="animate-flicker" role="img" aria-label="in progress">🚧</span>;
      return result;
    }

    // Sigh... the place where you can get the information you're
    // interested in at the top level is NOT the same as where you get
    // it inside, because of how Jenkins handles depth (Jenkins
    // *will* give you information for everything recursively, just
    // not in the place you might expect it.
    //
    //  class: "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
    //  id: "3772"
    //  subBuilds:
    //    0:
    //      jobName: "whatever"
    //      build:
    //        class: "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
    //        subBuilds:

    // TODO: do the slice server side
    //let builds = this.state.builds.slice(0, 10);
    let builds = this.state.builds;

    // TODO: This deeply assumes that you are viewing a thing with
    // subbuilds, not the actual build.

    function isInterestingBuild(b) {
      // Has to have executed at least one sub-build
      //  (usually, failing this means there was a merge conflict)
      if (b.subBuilds.length === 0) return false;
      // Did not have all sub-builds cancelled
      if (b.subBuilds.every((sb) => sb.result === 'ABORTED')) return false;
      return true;
    }
    builds = builds.filter(isInterestingBuild);

    const known_jobs_set = new Set();
    function collect_known_jobs_set(topBuild) {
      function go(subBuild) {
        if (subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
          subBuild.build.subBuilds.forEach(go);
        } else {
          known_jobs_set.add(subBuild.jobName);
        }
      }
      topBuild.subBuilds.forEach(go);
    }
    builds.forEach(collect_known_jobs_set);

    const known_jobs = [...known_jobs_set.values()].sort();
    const known_jobs_head = known_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div>{summarize_job(jobName)}</div></th>
    );

    const rows = builds.map((b) => {
      const sb_map = new Map();

      function collect_jobs(topBuild) {
        function go(subBuild) {
          if (subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
            subBuild.build.subBuilds.forEach(go);
          } else {
            sb_map.set(subBuild.jobName, subBuild);
          }
        }
        topBuild.subBuilds.forEach(go);
      }
      collect_jobs(b);

      const cols = known_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          cell = <a href={jenkins.link(sb.url + "/console")} className="icon" target="_blank" alt={sb.jobName}>{result_icon(sb.result)}</a>;
        }
        return <td key={jobName}>{cell}</td>;
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, '');
      }

      function renderPullRequestNumber(comment) {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return <Fragment><a href={"https://github.com/pytorch/pytorch/pull/" + m[1]} target="_blank">#{m[1]}</a></Fragment>;
        }
        return <Fragment />;
      }

      function renderCommit(commit) {
        return (
          <div key={commit.commitId}>
            {renderPullRequestNumber(commit.comment)} {drop_pr_number(commit.msg)}{' '}
            <code><a href={"https://github.com/pytorch/pytorch/commit/" + commit.commitId}
                     target="_blank">{commit.commitId.slice(0, 7)}</a></code>
          </div>
          );
      }

      function renderCauses(changeSet) {
        const defaultCause = <em>Manually triggered rebuild.</em>;
        if (changeSet.actions === undefined) return defaultCause;
        return changeSet.actions
          .filter((action) => action.causes !== undefined)
          .map((action, i) =>
            action.causes.map((cause, i) => <em key={i}>{cause.shortDescription}.{" "}</em>));
      }

      function getPushedBy(build) {
        const action = build.actions.find((action) => action._class === "hudson.model.CauseAction");
        if (action === undefined) return "(unknown)";
        const cause = action.causes.find((cause) => cause._class === "com.cloudbees.jenkins.GitHubPushCause");
        if (cause === undefined) return "";
        const match = cause.shortDescription.match(/Started by GitHub push by (.+)/);
        if (match === null) return cause.shortDescription;
        return match[1];
      }

      function getPullParams(build) {
        let action = build.actions.find((action) => action._class === "org.jenkinsci.plugins.ghprb.GhprbParametersAction");
        if (action === undefined) {
          action = build.actions.find((action) => action._class === "com.tikal.jenkins.plugins.multijob.MultiJobParametersAction");
        }
        if (action === undefined) {
          return new Map();
        }
        return new Map(action.parameters.map((param) => [param.name, param.value]));
      }

      const isRebuild = b.actions.some(
        (action) => action.causes !== undefined &&
                    action.causes.some(
                      (cause) => cause._class === "com.sonyericsson.rebuild.RebuildCause"
                    ));
      const isPullRequest = b.actions.some(
        (action) => action.causes !== undefined &&
                    action.causes.some(
                      (cause) => cause._class === "org.jenkinsci.plugins.ghprb.GhprbCause" ||
                                 (cause._class === "hudson.model.Cause$UpstreamCause" && /-pull-request$/.test(cause.upstreamProject))
                    ))

      function renderBuild(build) {
        if (isRebuild) {
          // TODO: copypaste
          return <Fragment><td></td><td className="right-cell">{renderCauses(build)}</td></Fragment>;
        } else if (isPullRequest) {
          const params = getPullParams(build);
          const title = params.get("ghprbPullTitle");
          const url = params.get("ghprbPullLink");
          const id = params.get("ghprbPullId");
          const author = params.get("ghprbPullAuthorLogin");
          return (
            <Fragment>
              <td className="right-cell">{author}</td>
              <td className="right-cell"><a href={url}>#{id}</a> {title}</td>
            </Fragment>
            );
        } else {
          const changeSet = build.changeSet;
          // TODO: This is empty for not pytorch-master.  We could
          // probably get the info if we propagate it as a variable.
          const pushedBy = getPushedBy(build);
          let desc;
          if (changeSet.items.length === 0) {
            desc = renderCauses(build);
          } else {
            desc = changeSet.items.slice().reverse().map(renderCommit);
          }
          return <Fragment><td>{pushedBy}</td><td className="right-cell">{desc}</td></Fragment>;
        }
      }

      return (
        <tr key={b.number}>
          <th className="left-cell"><a href={b.url} target="_blank">{b.number}</a></th>
          {cols}
          {renderBuild(b)}
        </tr>
        );
    });

    return (
      <div>
        <h2>
          {this.props.job} history{' '}
          <AsOf interval={this.props.interval}
                currentTime={this.state.currentTime}
                updateTime={this.state.updateTime} />
        </h2>
        <table>
          <thead>
            <tr>
              <th></th>
              {known_jobs_head}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}
