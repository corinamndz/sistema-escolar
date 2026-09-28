import { useState } from 'react';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import SchoolPeriodsTab from '../components/SchoolPeriodsTab';
import ClassroomsTab from '../components/ClassroomsTab';
import GradesTab from '../components/GradesTab';
import SectionsTab from '../components/SectionsTab';
import SubjectsTab from '../components/SubjectsTab';
import TeachingLoadTab from '../components/TeachingLoadTab';

const TABS = [
  { key: 'sections', label: 'Secciones' },
  { key: 'load', label: 'Carga docente' },
  { key: 'grades', label: 'Grados' },
  { key: 'subjects', label: 'Materias' },
  { key: 'classrooms', label: 'Aulas' },
  { key: 'periods', label: 'Años escolares' },
];

function AcademicsPage() {
  const [active, setActive] = useState('sections');

  return (
    <div>
      <PageHeader
        title="Estructura académica"
        subtitle="Niveles (Inicial, Primaria y Secundaria), grados, materias, secciones y asignación docente"
      />
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {active === 'sections' && <SectionsTab />}
      {active === 'load' && <TeachingLoadTab />}
      {active === 'grades' && <GradesTab />}
      {active === 'subjects' && <SubjectsTab />}
      {active === 'classrooms' && <ClassroomsTab />}
      {active === 'periods' && <SchoolPeriodsTab />}
    </div>
  );
}

export default AcademicsPage;
