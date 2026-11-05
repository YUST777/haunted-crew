import { createFileRoute } from '@tanstack/react-router';
import { Hero } from '../components/Hero';
import { CrewSection } from '../components/CrewSection';
import { FeaturesSection } from '../components/FeaturesSection';
import { Footer } from '../components/Footer';

export const Route = createFileRoute('/')({
  component: () => (
    <>
      <main>
        <Hero />
        <CrewSection />
        <FeaturesSection />
      </main>
      <Footer />
    </>
  ),
});
