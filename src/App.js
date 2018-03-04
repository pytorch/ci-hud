import React from 'react';
import './App.css';
import ComputerDisplay from './ComputerDisplay.js';
import QueueDisplay from './QueueDisplay.js';
import BuildHistoryDisplay from './BuildHistoryDisplay.js';
import { BrowserRouter as Router, Route, Link } from "react-router-dom";

const App = () => (
  <Router basename={process.env.PUBLIC_URL + '/'}>
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">ci.pytorch.org HUD</h1>
      </header>
      <ul className="menu">
        <li>
          <Link to="/">home</Link>
        </li>
        <li>
          <Link to="/build/pytorch-master">pytorch-master</Link>
        </li>
        <li>
          <Link to="/build/pytorch-pull-request">pytorch-pull-request</Link>
        </li>
      </ul>
      <Route exact path="/" component={Home} />
      <Route path="/build/:job" component={Build} />
    </div>
  </Router>
);

const Home = () => (
  <div>
    <QueueDisplay interval={1000} />
    <ComputerDisplay interval={1000} />
  </div>
);

const Build = ({ match }) => (
  <BuildHistoryDisplay interval={60000} job={match.params.job} />
);

export default App;
