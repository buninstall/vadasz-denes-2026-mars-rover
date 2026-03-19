import React from 'react';

export interface ActionCardItem {
  id: string;
  title: string;
  subtitle: string;
  tone: 'info' | 'warn' | 'ok';
}

interface ActionCardsProps {
  items: ActionCardItem[];
}

const ActionCards: React.FC<ActionCardsProps> = ({ items }) => {
  if (!items.length) return null;

  return (
    <div className="action-cards-shell">
      {items.map((item) => (
        <article key={item.id} className={`action-card action-card--${item.tone}`}>
          <h3 className="action-card-title">{item.title}</h3>
          <p className="action-card-subtitle">{item.subtitle}</p>
        </article>
      ))}
    </div>
  );
};

export default ActionCards;
