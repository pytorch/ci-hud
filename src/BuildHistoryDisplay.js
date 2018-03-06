import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job } from './Summarize.js';
import * as d3 from 'd3v4';
import parse_duration from 'parse-duration';

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
    const currentTime = new Date();
    this.setState({currentTime: currentTime});
    // NB: server-slide slicing doesn't really help, Jenkins seems to
    // load everything into memory anyway
    let data;
    if (true) {
      // STOP.  You want more results?  You may have noticed that on
      // Google, people suggest using allBuilds with {0,n} to make use
      // of Jenkins pagination.  However, if you do this, it will *DOS our Jeenkins
      // instance*; even when pagination is requested, Jenkins will
      // still load ALL builds into memory before servicing your
      // request.  I've filed this at https://issues.jenkins-ci.org/browse/JENKINS-49908
      data = await jenkins.job(this.props.job,
        {tree: `builds[
                  url,
                  number,
                  duration,
                  timestamp,
                  result,
                  actions[parameters[name,value],
                  causes[shortDescription]],
                  changeSet[items[commitId,comment,msg]],
                  subBuilds[
                    result,jobName,url,duration,
                    build[
                      subBuilds[
                        result,jobName,url,duration,
                        build[
                          subBuilds[result,jobName,url,duration]
                        ]
                      ]
                    ]
                  ]
               ]`.replace(/\s+/g, '')});
               // build[builtOn]
    } else {
      // If you want entries in build on subBuilds, need depth = 3
      // Otherwise, most data can be got with depth = 1
      const depth = 1;
      data = await jenkins.job(this.props.job, {depth: depth});
    }
    data.updateTime = new Date();
    data.connectedIn = data.updateTime - currentTime;
    if (data.allBuilds !== undefined) {
      data.builds = data.allBuilds;
    }
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

    let builds = this.state.builds;

    // TODO: This deeply assumes that you are viewing a thing with
    // subbuilds, not the actual build.

    function isInterestingBuild(b) {
      // Has to have executed at least one sub-build
      //  (usually, failing this means there was a merge conflict)
      // if (b.subBuilds.length === 0) return false;
      // Did not have all sub-builds cancelled
      // if (b.subBuilds.every((sb) => sb.result === 'ABORTED')) return false;
      // This would filter for only passing builds
      // if (b.subBuilds.some((sb) => sb.result === 'FAILURE' || sb.result === 'ABORTED')) return false;
      return true;
    }
    builds = builds.filter(isInterestingBuild);

    function getJobName(subBuild) {
      const baseJobName = subBuild.jobName;
      if (subBuild.build && subBuild.build.builtOn && baseJobName.match(/^ccache-cleanup-.*$/)) {
        return baseJobName + "/" + subBuild.build.builtOn;
      }
      return baseJobName;
    }

    const known_jobs_set = new Set();
    const this_job = "*"; // this.props.job;
    function collect_known_jobs_set(topBuild) {
      function go(subBuild) {
        known_jobs_set.add(getJobName(subBuild));
        if (subBuild.build && subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
          subBuild.build.subBuilds.forEach(go);
        }
      }
      known_jobs_set.add(this_job);
      topBuild.subBuilds.forEach(go);
    }
    builds.forEach(collect_known_jobs_set);

    const known_jobs = [...known_jobs_set.values()].sort();
    const known_jobs_head = known_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div>{summarize_job(jobName)}</div></th>
    );

    const durationWidth = 120;
    const durationHeight = 10;
    const durationScale = d3.scaleLinear().rangeRound([0, durationWidth]);
    durationScale.domain([0, d3.max(builds, (b) => b.duration)]);

    const rows = builds.map((b) => {
      const sb_map = new Map();

      function collect_jobs(topBuild) {
        function go(subBuild) {
          sb_map.set(getJobName(subBuild), subBuild);
          if (subBuild.build && subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
            subBuild.build.subBuilds.forEach(go);
          }
        }
        sb_map.set(this_job, topBuild);
        topBuild.subBuilds.forEach(go);
      }
      collect_jobs(b);

      function perf_report(sb) {
        return <Fragment>{parse_duration(sb.duration)/1000}&nbsp;&nbsp;</Fragment>;
      }

      const cols = known_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          if (this.props.mode === "perf") {
            cell = perf_report(sb)
          } else {
            cell = <a href={jenkins.link(sb.url + "/console")}
                      className="icon"
                      target="_blank"
                      alt={getJobName(sb)}>
                     {result_icon(sb.result)}
                   </a>;
          }
        }
        return <td key={jobName} style={{textAlign: "right", fontFamily: "sans-serif"}}>{cell}</td>;
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
        let author = "";
        let desc = "";

        if (isRebuild) {
          desc = renderCauses(build);
        } else if (isPullRequest) {
          const params = getPullParams(build);
          const title = params.get("ghprbPullTitle");
          const url = params.get("ghprbPullLink");
          const id = params.get("ghprbPullId");
          author = params.get("ghprbPullAuthorLogin");
          desc = <Fragment><a href={url} target="_blank">#{id}</a> {title}</Fragment>;
        } else {
          const changeSet = build.changeSet;
          // TODO: This is empty for not pytorch-master.  We could
          // probably get the info if we propagate it as a variable.
          author = getPushedBy(build);
          if (changeSet.items.length === 0) {
            desc = renderCauses(build);
          } else {
            desc = changeSet.items.slice().reverse().map(renderCommit);
          }
        }

        return <Fragment>
                <td className="right-cell bar-number">{Math.floor(build.duration/1000/60)}</td>
                <td>
                  <svg width={durationWidth} height={durationHeight}>
                    <rect className="bar"
                          x="0"
                          y="0"
                          width={durationScale(build.duration)}
                          height={durationHeight} />
                  </svg>
                </td>
                <td className="right-cell">{author}</td>
                <td className="right-cell">{desc}</td></Fragment>;
      }

      const date = new Date(b.timestamp);
      const today = new Date();
      let whenString;
      if (today.toLocaleDateString() === date.toLocaleDateString()) {
        whenString = date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
      } else {
        whenString = date.toLocaleString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
      }

      return (
        <tr key={b.number}>
          <th className="left-cell"><a href={b.url} target="_blank">{b.number}</a></th>
          <td className="left-cell">{whenString}</td>
          {cols}
          {renderBuild(b)}
        </tr>
        );
    });

    return (
      <div>
        <h2>
          <a href={jenkins.link("job/" + this.props.job)} target="_blank">{this.props.job}</a> history{' '}
          <AsOf interval={this.props.interval}
                connectedIn={this.state.connectedIn}
                currentTime={this.state.currentTime}
                updateTime={this.state.updateTime} />
        </h2>
        <table>
          <thead>
            <tr>
              <th className="left-cell">No.</th>
              <th className="left-cell">Date</th>
              {known_jobs_head}
              <th className="right-cell" colSpan="2">Total time (min)</th>
              <th className="right-cell">User</th>
              <th className="right-cell">Description</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}

