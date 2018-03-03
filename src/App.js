import React, { Component } from 'react';
import './App.css';
import ComputerDisplay from './ComputerDisplay.js';
import QueueDisplay from './QueueDisplay.js';
import BuildHistoryDisplay from './BuildHistoryDisplay.js';

class App extends Component {

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">ci.pytorch.org HUD</h1>
        </header>
        <BuildHistoryDisplay interval={60000} job="pytorch-pull-request" />
        { /*
        <BuildHistoryDisplay interval={60000} job="pytorch-master" />
        <QueueDisplay interval={1000} />
        <ComputerDisplay interval={1000} />
        */ }
      </div>
    );
  }
}

export default App;
