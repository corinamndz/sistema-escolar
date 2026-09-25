/** `tabs = [{ key, label }]`, controlado por el padre (`active` + `onChange`). */
function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tabs__item ${active === tab.key ? 'tabs__item--active' : ''}`}
          onClick={() => onChange(tab.key)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
