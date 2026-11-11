import { createFileRoute } from '@tanstack/react-router';
import { Docs } from '../components/Docs';

export const Route = createFileRoute('/docs/$page')({
  component: () => <Docs slug={Route.useParams().page} />,
});
