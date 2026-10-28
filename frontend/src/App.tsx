import { useEffect, useState } from 'react';
import './App.css';
import Page from './components/Page';
import { LightningStore, LightningStoreContext } from './lightning/LightningStore';

function App() {
  const [ lightningStore ] = useState<LightningStore>(new LightningStore());

  useEffect(() => {
    lightningStore.initialize("", "");
  }, [lightningStore]);

  return (
    <LightningStoreContext.Provider value={lightningStore}>
      <div className="app">
          <h1 className="app-title"> Create LN App </h1>
          <p className="app-text"> Get Started with creating a full-stack App on the Lightning Network. </p>

          <Page />
      </div>
    </LightningStoreContext.Provider>
  );
}

export default App;
