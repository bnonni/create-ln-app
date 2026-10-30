'use client';
// The home page. It is a client component, because the Page component uses React state and effects.
import '../App.css';
import Page from '../components/Page';

export default function Home() {
  return (
    <div className="app">
        <h1 className="app-title"> Create LN App </h1>
        <p className="app-text"> Get Started with creating a full-stack App on the Lightning Network. </p>

        <Page />
    </div>
  );
}
