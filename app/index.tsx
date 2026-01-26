import { Redirect } from 'expo-router';

/**
 * Root Index - Redirects to Bootstrap
 * 
 * Bootstrap screen handles session restoration and navigation
 */
export default function Index() {
  return <Redirect href="/Bootstrap" />;
}