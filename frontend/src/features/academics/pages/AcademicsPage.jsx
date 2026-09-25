import { useState } from 'react';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import SchoolPeriodsTab from '../components/SchoolPeriodsTab';
import ClassroomsTab from '../components/ClassroomsTab';
import GradesTab from '../components/GradesTab';
import SectionsTab from '../components/SectionsTab';

const TABS = [
  { key: 'sections', label: 'Secciones' },
  { key: 'grades', label: 'Grados' },
  { key: 'classrooms', label: 'Aulas' },
  { key: 'periods', label: 'Años escolares' },
];

function AcademicsPage() {
  const [active, setActive] = useState('sections');

  return (
    <div>
      <PageHeader title="Estructura académica" subtitle="Años escolares, aulas, grados y secciones" />
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {active === 'sections' && <SectionsTab />}
      {active === 'grades' && <GradesTab />}
      {active === 'classrooms' && <ClassroomsTab />}
      {active === 'periods' && <SchoolPeriodsTab />}
    </div>
  );
}

export default AcademicsPage;
