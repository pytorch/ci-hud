import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job } from './Summarize.js';

/* intersperse: Return an array with the separator interspersed between
 * each element of the input array.
 *
 * > _([1,2,3]).intersperse(0)
 * [1,0,2,0,3]
 */
function intersperse(arr, sep) {
    if (arr.length === 0) {
        return [];
    }

    return arr.slice(1).reduce(function(xs, x, i) {
        return xs.concat([sep, x]);
    }, [arr[0]]);
}

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
    this.setState(data);
  }
  render() {
    function result_icon(result) {
      if (result === 'SUCCESS') return '✅';
      if (result === 'FAILURE') return '❌';
      if (result === 'ABORTED') return '⭕';
      if (!result) return '❓';
      return result;
    }

    // TODO: do the slice server side
    // let builds = this.state.builds.slice(0, 10);
    let builds = this.state.builds;
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
    builds.forEach((b) => {
      b.subBuilds.forEach((sb) => {
        known_jobs_set.add(sb.jobName);
      });
    });
    // NB: use insertion order
    const known_jobs = [...known_jobs_set.values()];

    const known_jobs_head = known_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div><span>{summarize_job(jobName)}</span></div></th>
    );

    const rows = builds.map((b) => {
      const sb_map = new Map();
      b.subBuilds.forEach(sb => {
        sb_map.set(sb.jobName, sb);
      });

      const cols = known_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          cell = <a href={jenkins.link(sb.url)} className="icon" target="_blank" alt={sb.jobName}>{result_icon(sb.result)}</a>;
        }
        return <td key={jobName}>{cell}</td>;
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, '');
      }

      function renderPullRequestNumber(comment) {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return <Fragment>(<a href={"https://github.com/pytorch/pytorch/pull/" + m[1]} target="_blank">#{m[1]}</a>)</Fragment>;
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
        const defaultCause = <em>Manually triggered rebuild</em>;
        if (changeSet.actions === undefined) return defaultCause;
        return intersperse(changeSet.actions
          .filter((action) => action.causes !== undefined)
          .map((action, i) =>
            action.causes.map((cause, i) => <em key={i}>{cause.shortDescription}</em>)),
          "; ");
      }

      const isPullRequest = b.actions.some(
        (action) => action.causes !== undefined &&
                    action.causes.some(
                      (cause) => cause._class === "org.jenkinsci.plugins.ghprb.GhprbCause"
                    ))

      function renderBuild(build) {
        if (isPullRequest) {
          return <td dangerouslySetInnerHTML={{__html: build.description}} />;
        } else {
          const changeSet = build.changeSet;
          if (changeSet.items.length === 0) {
            return <td>{renderCauses(build)}</td>;
          } else {
            return <td>{changeSet.items.slice().reverse().map(renderCommit)}</td>
          }
        }
      }

      console.log(b);
      return (
        <tr key={b.number}>
          <th><a href={b.url} target="_blank">{b.number}</a></th>
          {cols}
          {renderBuild(b)}
        </tr>
        );
    });

    return (
      <div>
        <h2>{this.props.job} history <AsOf interval={this.props.interval} currenttime={this.state.currentTime} updateTime={this.state.updateTime} /></h2>
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

