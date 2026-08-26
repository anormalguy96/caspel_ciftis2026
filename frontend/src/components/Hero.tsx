import React from 'react';
import en from '../locales/en.json';

export const Hero: React.FC = () => (
  <section className="hero">
    <div className="container hero__inner">
      <h1 className="hero__title">{en.hero.title}</h1>
      <p className="hero__subtitle">{en.hero.subtitle}</p>
    </div>
  </section>
);
