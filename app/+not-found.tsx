import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../constants/theme';

export default function NotFoundScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('navigation.notFound') }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('notFound.title')}</Text>
        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.solo }]}>{t('notFound.goToToday')}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 18, fontWeight: '600' },
  link: { marginTop: 16, paddingVertical: 12 },
  linkText: { fontSize: 15, fontWeight: '600' },
});
