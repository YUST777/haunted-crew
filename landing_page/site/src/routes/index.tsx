import { createFileRoute } from '@tanstack/react-router';
import { Hero } from '../components/Hero';
import { KiroSection } from '../components/KiroSection';
import { CrewSection } from '../components/CrewSection';
import { FeaturesSection } from '../components/FeaturesSection';
import { Footer } from '../components/Footer';

export const Route = createFileRoute('/')({
  component: () => (
    <>
      <main>
        <Hero />
        <KiroSection />
        <CrewSection />
        <FeaturesSection />
      </main>
      <Footer />
    </>
  ),
});
