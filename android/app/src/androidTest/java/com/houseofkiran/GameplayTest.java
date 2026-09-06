package com.houseofkiran;

import android.webkit.WebView;
import android.app.KeyguardManager;
import android.content.Context;
import android.view.WindowManager;
import android.graphics.Bitmap;
import androidx.lifecycle.Lifecycle;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONObject;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeNotNull;

/** Runs the bundled game in the actual Android WebView, with real event handlers and timers. */
@RunWith(AndroidJUnit4.class)
public class GameplayTest {
    private void screenshot(String name) throws Exception {
        File directory = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null), "qa");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Screenshot available", bitmap);
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        } finally { bitmap.recycle(); }
    }

    private void requireUnlockedPhone() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        assertFalse("Unlock the phone before running interactive gameplay tests", keyguard.isDeviceLocked());
    }

    private WebView gameView(ActivityScenario<MainActivity> scenario) {
        AtomicReference<WebView> reference = new AtomicReference<>();
        scenario.onActivity(activity -> {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            reference.set(activity.gameView());
        });
        return reference.get();
    }

    private String js(WebView view, String source) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                view.evaluateJavascript(source, result -> { value.set(result); done.countDown(); }));
        assertTrue("WebView JavaScript callback", done.await(5, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(WebView view, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(js(view, "Boolean(" + expression + ")"))) return;
            Thread.sleep(50);
        }
        fail("Timed out: " + expression + "; page=" + js(view,
                "JSON.stringify({url:location.href,ready:document.readyState,app:typeof HOKApp,online:typeof HOKOnlineController,body:document.body&&document.body.innerText.slice(0,200)})"));
    }

    @Test
    public void offlineDiceMovesResumeAndOnlineSwitch() throws Exception {
        requireUnlockedPhone();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = gameView(scenario);
            waitFor(view, "window.HOKApp && window.HOKOnlineController");
            assertEquals("true", js(view,"document.getElementById('onlineLobby').hidden"));
            assertEquals("true", js(view,"document.documentElement.scrollWidth <= window.innerWidth"));
            screenshot("home");
            js(view,"document.getElementById('learnBtn').click(); document.getElementById('tutorialSkipBtn').click();");
            assertEquals("true", js(view,"!tutorialState.active && document.getElementById('setup').style.display==='block'"));
            js(view,"document.getElementById('modeOnlineBtn').click(); document.getElementById('onlineOffline').click(); document.getElementById('modeMultiBtn').click(); document.getElementById('startBtn').click(); state.devForceRoll=6; document.getElementById('rollAction').click();");
            waitFor(view,"state.pendingRolls.length===1 && state.pendingRolls[0]===6");
            screenshot("local-game");
            js(view,"state.devForceRoll=1; document.getElementById('rollAction').click();");
            waitFor(view,"state.phase==='moving'");
            js(view,"document.querySelector('.piece[data-pid=red0]').click();");
            waitFor(view,"state.pieces[0].relPos===1 && !state.animating");
            js(view,"HOKApp.goHome(); document.getElementById('leaveBtn').click(); document.getElementById('resumeBtn').click();");
            assertEquals("1",js(view,"state.pieces[0].relPos"));
            assertEquals("true",js(view,"document.documentElement.scrollWidth <= window.innerWidth"));
            js(view,"HOKApp.goHome(); document.getElementById('leaveBtn').click(); window.phoneSaved=localStorage.getItem('hok_offline_v1'); document.getElementById('learnBtn').click(); tutorialNext(); tutorialNext(); skipTutorial();");
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            assertEquals("true",js(view,"localStorage.getItem('hok_offline_v1')===window.phoneSaved"));
            js(view,"document.getElementById('resumeBtn').click();");
            assertEquals("1",js(view,"state.pieces[0].relPos"));
            js(view,"backToSetup(); document.getElementById('modeSingleBtn').click(); pickYourColor('green'); startGame(); state.devForceRoll=6;");
            waitFor(view,"state.rollHistory.length>0");
            js(view,"backToSetup();");
        }
    }

    @Test
    public void onlineAccountRoomAndRollOverUsb() throws Exception {
        String base = InstrumentationRegistry.getArguments().getString("phoneServerUrl");
        assumeNotNull(base); // Use a temporary local server; never a user's production account.
        requireUnlockedPhone();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = gameView(scenario);
            waitFor(view,"window.HOKApp && window.HOKOnlineController");
            js(view,"document.getElementById('modeOnlineBtn').click(); document.getElementById('onlineBaseUrl').value=" + JSONObject.quote(base) + "; document.getElementById('onlineUser').value='phone'+Date.now(); document.getElementById('onlinePassword').value='phone-qa-password-123'; document.getElementById('onlineRegister').click();");
            waitFor(view,"document.getElementById('onlineToken').value && !document.getElementById('onlineRegister').disabled");
            assertEquals("true",js(view,"JSON.parse(AndroidSession.getToken()).token===document.getElementById('onlineToken').value"));
            js(view,"document.getElementById('onlinePlayers').value='2'; document.getElementById('onlineCreate').click();");
            waitFor(view,"HOKOnlineBridge.isOnline() && document.getElementById('roomCode').value");
            assertEquals("true",js(view,"document.getElementById('rollAction').disabled"));
            // A second test account joins through the real HTTP API; the phone must receive its roster via WebSocket.
            js(view,"(async()=>{try{const base=" + JSONObject.quote(base) + "; const post=async(path,body,token)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};const other=await post('/v1/auth/register',{username:'guest'+Date.now(),password:'phone-qa-password-123'});await post('/v1/games/'+document.getElementById('roomCode').value+'/join',{color:'yellow'},other.token);window.phoneJoinDone=true;}catch(e){window.phoneJoinError=e.message;}})();");
            waitFor(view,"window.phoneJoinDone && HOKOnlineController.canPlay()");
            js(view,"window.phoneVersion=state.version; document.getElementById('rollAction').click();");
            waitFor(view,"state.version>window.phoneVersion");
            screenshot("online-game");
            js(view,"backToSetup(); HOKOnlineController.openLobby(); document.getElementById('onlineLogout').click(); HOKOnlineController.closeLobby(); localStorage.removeItem('hok_online_room');");
            assertEquals("\"\"",js(view,"AndroidSession.getToken()"));
        }
    }
}
