import React from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

/**
 * A real 404.
 *
 * Unknown product slugs previously fell through to the Corporate deck, which
 * quietly showed a visitor the wrong presentation. document.md §26 requires
 * that nobody is ever left at a dead end, so this always offers a way home.
 */
export const NotFoundPage: React.FC = () => (
  <div className="page">
    <Header />

    <main className="container page__main not-found">
      <p className="not-found__code">404</p>
      <h1 className="not-found__title">This page isn&rsquo;t part of the CASPEL hub</h1>
      <p className="not-found__text">
        The link may be out of date. Everything in the CASPEL presentation hub is one tap away.
      </p>
      <Link to="/" className="btn btn--primary">
        Back to CASPEL solutions
      </Link>
    </main>

    <Footer />
  </div>
);
