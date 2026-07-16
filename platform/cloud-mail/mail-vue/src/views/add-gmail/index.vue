<template>
  <div class="add-gmail-page">
    <section class="add-gmail-panel">
      <div class="add-gmail-header">
        <Icon icon="logos:google-gmail" width="36" height="36" />
        <div>
          <h1>{{ $t('addGmail') }}</h1>
          <p>{{ $t('addGmailDetail') }}</p>
        </div>
      </div>

      <el-alert
          class="add-gmail-alert"
          :title="$t('addGmailUnifiedAuth')"
          type="info"
          :closable="false"
          show-icon
      />

      <el-button class="continue-button" type="primary" size="large" :loading="loading" @click="continueWithGoogle">
        {{ $t('continueWithGoogle') }}
      </el-button>
    </section>
  </div>
</template>

<script setup>
import {Icon} from "@iconify/vue";
import {ref} from "vue";
import {googleMailboxOAuthStart} from "@/request/account.js";

const loading = ref(false);

function continueWithGoogle() {
  if (loading.value) return;
  loading.value = true;
  googleMailboxOAuthStart().then(data => {
    if (data?.authorizationUrl) {
      window.location.assign(data.authorizationUrl);
      return;
    }
    ElMessage({
      message: 'Google sign-in could not be started.',
      type: 'error',
      plain: true
    });
    loading.value = false;
  }).catch(() => {
    loading.value = false;
  });
}
</script>

<style scoped lang="scss">
.add-gmail-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--el-bg-color);
}

.add-gmail-panel {
  width: min(520px, 100%);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 24px;
  background: var(--el-bg-color);
}

.add-gmail-header {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: start;

  h1 {
    margin: 0 0 6px;
    font-size: 22px;
    line-height: 1.2;
  }

  p {
    margin: 0;
    color: var(--secondary-text-color);
    line-height: 1.45;
  }
}

.add-gmail-alert {
  margin-top: 18px;
}

.continue-button {
  width: 100%;
  margin-top: 18px;
}
</style>
